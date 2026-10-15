from fastapi import APIRouter, Depends

from app import usage
from app.security import current_owner

router = APIRouter(tags=["usage"], dependencies=[Depends(current_owner)])


@router.get("/usage")
def get_usage():
    """Today's model usage against the backend's own spend limits."""
    return usage.snapshot()
