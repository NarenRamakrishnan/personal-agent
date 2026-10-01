from fastapi import APIRouter, Depends

from app import usage
from app.security import require_api_key

router = APIRouter(tags=["usage"], dependencies=[Depends(require_api_key)])


@router.get("/usage")
def get_usage():
    """Today's model usage against the backend's own spend limits."""
    return usage.snapshot()
