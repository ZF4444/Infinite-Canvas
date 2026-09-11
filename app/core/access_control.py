"""按用户类型区分的页面访问控制。

- PostgreSQL `app_settings.access_control`，结构：
    {
      "types": {"new-user": {"name": "默认用户", "pages": ["canvas", ...]}},
      "user_types": {"<user_id>": "new-user"}
    }
- 语义：
    * 每位用户按所属用户类型获得 pages 权限。
    * 未分配类型的用户使用「默认用户」类型。
    * 校验/保存时会过滤掉不在全集清单中的非法 id。

依赖：PostgreSQL app_settings 与用户注册表。
本模块不引用 FastAPI app 对象，避免循环导入。
"""
import os
import re
import copy
from threading import Lock
from typing import Any, Dict, List

from app.config import STATIC_DIR
from app.core.logging import get_logger


logger = get_logger("access_control")
from app.services.business_metadata import get_app_setting, set_app_setting

DEFAULT_USER_TYPE_ID = "new-user"
DEFAULT_USER_TYPE_NAME = "默认用户"
ADMIN_USER_ID = os.getenv("ADMIN_USER_ID", "admin").strip() or "admin"

ACCESS_CONTROL_LOCK = Lock()
_ACCESS_CONTROL_CACHE = None

# 侧边栏首页文件（唯一真实来源）：页面清单从这里动态解析，避免与本文件的硬编码列表脱节。
STUDIO_INDEX_HTML_FILE = os.path.join(STATIC_DIR, "index.html")

# 导航项开标签之后、下一个同级闭合前，最近的可见文案 span（data-i18n 缺省时取其内文本兜底）。
_LABEL_SPAN_RE = re.compile(
    r'<span[^>]*class="(?:nav-text|side-pill-text)"[^>]*>(?P<text>.*?)</span>',
    re.DOTALL,
)

# 解析失败（文件缺失/格式变化导致 0 结果）时的兜底清单，避免访问控制页面完全瘫痪。
_FALLBACK_ALL_PAGES: List[Dict[str, str]] = [
    {"id": "angle", "label": "视角粗调"},
    {"id": "gaussian", "label": "视角微调"},
    {"id": "pose-studio", "label": "姿势编辑"},
    {"id": "gpt-chat", "label": "GPT 对话"},
    {"id": "canvas", "label": "无限画布"},
    {"id": "canvas-agent", "label": "画布 Agent"},
    {"id": "asset-manager", "label": "素材库"},
    {"id": "storage-manager", "label": "空间管理"},
    {"id": "my-account", "label": "我的账户"},
    {"id": "api-settings", "label": "API 设置"},
    {"id": "comfyui-settings", "label": "工作流设置"},
    {"id": "user-management", "label": "用户管理"},
    {"id": "user-data-migration", "label": "用户数据迁移"},
    {"id": "feedback-admin", "label": "反馈管理"},
    {"id": "broadcast-admin", "label": "全局广播"},
]


def _extract_nav_items(html: str) -> List[Dict[str, str]]:
    """从 index.html 源码中提取全部 switchUI(this, 'id') 导航入口及其可见文案。

    侧边栏中的每个页面入口均可由用户类型授权。
    """
    items: List[Dict[str, str]] = []
    seen = set()
    matches = list(re.finditer(r'<[^>]*onclick="switchUI\(this,\s*\'([a-zA-Z0-9-]+)\'\)"[^>]*>', html))
    for idx, m in enumerate(matches):
        tag = m.group(0)
        page_id = m.group(1)
        if page_id in seen:
            continue
        # 在该导航项标签之后、下一个导航项标签开始之前的区间内查找可见文案 span，
        # 取其内文本作为 label（不依赖固定字符数，避免图标标记变化导致窗口不够）。
        end = matches[idx + 1].start() if idx + 1 < len(matches) else min(len(html), m.end() + 4000)
        tail = html[m.end():end]
        label_match = _LABEL_SPAN_RE.search(tail)
        label = re.sub(r'<[^>]*>', '', label_match.group("text")).strip() if label_match else page_id
        seen.add(page_id)
        items.append({"id": page_id, "label": label or page_id})
    return items


def _load_all_pages() -> List[Dict[str, str]]:
    """动态解析 static/index.html，得到当前侧边栏实际存在的页面清单。

    这样新增/删除页面时只需改 index.html 的导航项，访问控制的全集清单会自动同步，
    不再需要手动维护第二份硬编码列表。解析失败或结果为空时回退到静态兜底清单。
    """
    try:
        with open(STUDIO_INDEX_HTML_FILE, "r", encoding="utf-8") as f:
            html = f.read()
        items = _extract_nav_items(html)
        if items:
            if not any(item.get("id") == "canvas-agent" for item in items):
                canvas_index = next((i for i, item in enumerate(items) if item.get("id") == "canvas"), len(items) - 1)
                items.insert(canvas_index + 1, {"id": "canvas-agent", "label": "画布 Agent"})
            return items
    except Exception:
        logger.exception("failed to parse navigation pages; using fallback", extra={"event": "navigation_pages_parse_failed"})
    return list(_FALLBACK_ALL_PAGES)


def all_pages() -> List[Dict[str, str]]:
    """对外暴露的页面全集清单（每次调用都重新解析，随 index.html 改动即时生效）。"""
    return _load_all_pages()


def all_page_ids() -> List[str]:
    return [p["id"] for p in all_pages()]


def is_model_allowed(user_id: str, connection_id: str, model: str) -> bool:
    """User-type access control currently scopes pages, not model allowlists."""
    return bool(str(user_id or "").strip() and str(connection_id or "").strip() and str(model or "").strip())


def is_admin(user_id: str) -> bool:
    return str(user_id or "") == ADMIN_USER_ID


def has_page_access(user_id: str, page_id: str) -> bool:
    """用户是否拥有指定侧边栏页面的权限。"""
    return str(page_id or "") in set(effective_permissions(user_id).get("pages") or [])


def _legacy_config_to_types(data: Dict[str, Any]) -> Dict[str, Any]:
    """将旧版默认/单用户权限转换为用户类型，保留既有权限。"""
    types = {
        DEFAULT_USER_TYPE_ID: {
            "name": DEFAULT_USER_TYPE_NAME,
            **_sanitize_user_entry(data.get("default") if isinstance(data.get("default"), dict) else {}),
        }
    }
    user_types = {}
    for uid, entry in (data.get("users") or {}).items():
        if not uid:
            continue
        type_id = f"legacy-{uid}"
        types[type_id] = {"name": f"迁移用户 {uid}", **_sanitize_user_entry(entry)}
        user_types[uid] = type_id
    return {"types": types, "user_types": user_types}


def _normalize_config(data: Any) -> Dict[str, Any]:
    """规范化当前格式，同时兼容旧版访问控制设置。"""
    if not isinstance(data, dict) or not isinstance(data.get("types"), dict):
        return _legacy_config_to_types(data if isinstance(data, dict) else {})
    types = {}
    for type_id, entry in data["types"].items():
        type_id = str(type_id or "").strip()
        if not type_id:
            continue
        entry = entry if isinstance(entry, dict) else {}
        name = str(entry.get("name") or type_id).strip()[:80] or type_id
        if type_id == DEFAULT_USER_TYPE_ID and name == "新用户":
            name = DEFAULT_USER_TYPE_NAME
        types[type_id] = {"name": name, **_sanitize_user_entry(entry)}
    if DEFAULT_USER_TYPE_ID not in types:
        types[DEFAULT_USER_TYPE_ID] = {"name": DEFAULT_USER_TYPE_NAME, **_sanitize_user_entry({})}
    user_types = {}
    for uid, type_id in (data.get("user_types") or {}).items():
        uid, type_id = str(uid or "").strip(), str(type_id or "").strip()
        if uid and type_id in types:
            user_types[uid] = type_id
    return {"types": types, "user_types": user_types}


def _load_config_unlocked() -> Dict[str, Any]:
    global _ACCESS_CONTROL_CACHE
    if _ACCESS_CONTROL_CACHE is not None:
        return copy.deepcopy(_ACCESS_CONTROL_CACHE)
    _ACCESS_CONTROL_CACHE = _normalize_config(get_app_setting("access_control", {}))
    return copy.deepcopy(_ACCESS_CONTROL_CACHE)


def warm_access_control_cache() -> Dict[str, Any]:
    global _ACCESS_CONTROL_CACHE
    with ACCESS_CONTROL_LOCK:
        _ACCESS_CONTROL_CACHE = None
        return _load_config_unlocked()


def load_config() -> Dict[str, Any]:
    """读取整份访问控制配置。"""
    with ACCESS_CONTROL_LOCK:
        return _load_config_unlocked()


def _sanitize_user_entry(entry: Any) -> Dict[str, List[str]]:
    """把单个用户类型配置规范化为页面权限，过滤非法 id 并去重保序。"""
    entry = entry if isinstance(entry, dict) else {}
    raw_pages = entry.get("pages")
    # None 表示"全部"（未限制），保存为完整全集；列表表示显式集合。
    valid_page_ids = all_page_ids()
    if raw_pages is None:
        pages = valid_page_ids
    else:
        requested = set(raw_pages)
        # 空间管理从素材库拆出后沿用原素材库权限，避免已有用户类型因页面拆分突然失去入口。
        if "asset-manager" in requested and "storage-manager" in valid_page_ids:
            requested.add("storage-manager")
        pages = [p for p in valid_page_ids if p in requested]
    return {"pages": pages}


def save_config(payload: Dict[str, Any]) -> Dict[str, Any]:
    """规范化并持久化用户类型及用户类型分配。"""
    payload = payload if isinstance(payload, dict) else {}
    types_in = payload.get("types") if isinstance(payload.get("types"), dict) else {}
    assignments_in = payload.get("user_types") if isinstance(payload.get("user_types"), dict) else {}
    sanitized: Dict[str, Any] = {"types": {}, "user_types": {}}
    for type_id, entry in types_in.items():
        type_id = str(type_id or "").strip()
        if not type_id:
            continue
        entry = entry if isinstance(entry, dict) else {}
        name = str(entry.get("name") or type_id).strip()[:80] or type_id
        if type_id == DEFAULT_USER_TYPE_ID and name == "新用户":
            name = DEFAULT_USER_TYPE_NAME
        sanitized["types"][type_id] = {
            "name": name,
            **_sanitize_user_entry(entry),
        }
    if DEFAULT_USER_TYPE_ID not in sanitized["types"]:
        sanitized["types"][DEFAULT_USER_TYPE_ID] = {"name": DEFAULT_USER_TYPE_NAME, **_sanitize_user_entry({})}
    for uid, type_id in assignments_in.items():
        uid, type_id = str(uid or "").strip(), str(type_id or "").strip()
        if uid and type_id in sanitized["types"]:
            sanitized["user_types"][uid] = type_id
    global _ACCESS_CONTROL_CACHE
    with ACCESS_CONTROL_LOCK:
        set_app_setting("access_control", sanitized)
        _ACCESS_CONTROL_CACHE = copy.deepcopy(sanitized)
    return sanitized


def effective_permissions(user_id: str) -> Dict[str, Any]:
    """计算指定用户的有效权限。

    优先级：用户所属类型 > 默认用户类型。
    """
    config = load_config()
    type_id = config.get("user_types", {}).get(user_id, DEFAULT_USER_TYPE_ID)
    entry = config.get("types", {}).get(type_id) or config["types"][DEFAULT_USER_TYPE_ID]
    sanitized = _sanitize_user_entry(entry)
    return {"user_type": type_id, "pages": sanitized["pages"]}
