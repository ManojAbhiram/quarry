from typing import Any, Dict, List

from bson import ObjectId


def normalize_object_id(value: Any) -> Any:
    """
    Convert valid Mongo ObjectId strings to ObjectId.
    Leave other values unchanged.
    """
    if isinstance(value, ObjectId):
        return value
    if isinstance(value, str) and ObjectId.is_valid(value):
        return ObjectId(value)
    return value


def id_query(field: str, value: Any) -> Dict[str, Any]:
    """
    Build a query that matches both ObjectId and string forms.
    Useful during mixed-schema transitions.
    """
    if value is None:
        return {field: None}

    if isinstance(value, ObjectId):
        return {field: {"$in": [value, str(value)]}}

    if isinstance(value, str) and ObjectId.is_valid(value):
        oid = ObjectId(value)
        return {field: {"$in": [oid, value]}}

    return {field: value}


def id_values(value: Any) -> List[Any]:
    """
    Return possible representations of an ID for writes/deletes.
    """
    query = id_query("_id", value)
    raw = query["_id"]
    if isinstance(raw, dict) and "$in" in raw:
        return raw["$in"]
    return [raw]
