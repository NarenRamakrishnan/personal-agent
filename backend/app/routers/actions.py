from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from app import config, emailer, llm
from app.db import get_session
from app.models import Action, ActionRow, EmailRequest, EmailUpdate, utcnow
from app.parser import resolve_tz
from app.security import require_api_key

router = APIRouter(prefix="/actions", tags=["actions"], dependencies=[Depends(require_api_key)])


def get_or_404(db: Session, action_id: str) -> ActionRow:
    row = db.get(ActionRow, action_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Action not found")
    return row


@router.post("/email", response_model=Action, status_code=201, response_model_exclude_none=True)
def create_email_draft(body: EmailRequest, db: Session = Depends(get_session)):
    """Draft an email from speech. Always lands as needs_approval: nothing is
    ever sent by the backend, and the phone must get an explicit approval first."""
    try:
        draft = emailer.make_draft(body.text, body.now or utcnow(), resolve_tz(body.timezone))
    except emailer.NoEmailRequest:
        raise HTTPException(status_code=422, detail="That doesn't look like a request to send an email")
    except llm.LLMError:
        raise HTTPException(status_code=503, detail="Drafting is temporarily unavailable")
    row = ActionRow(
        session_id=body.session_id, source_text=body.text if config.STORE_TRANSCRIPTS else None,
        to=draft.to, to_name=draft.to_name, subject=draft.subject, body=draft.body,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row.to_api()


@router.get("", response_model=list[Action], response_model_exclude_none=True)
def list_actions(
    session_id: str | None = Query(default=None, alias="sessionId"),
    db: Session = Depends(get_session),
):
    query = select(ActionRow).order_by(ActionRow.created_at, ActionRow.id)
    if session_id:
        query = query.where(ActionRow.session_id == session_id)
    return [r.to_api() for r in db.exec(query)]


@router.get("/{action_id}", response_model=Action, response_model_exclude_none=True)
def get_action(action_id: str, db: Session = Depends(get_session)):
    return get_or_404(db, action_id).to_api()


@router.patch("/{action_id}", response_model=Action, response_model_exclude_none=True)
def edit_draft(action_id: str, body: EmailUpdate, db: Session = Depends(get_session)):
    """Edit a draft. Any edit withdraws a prior approval: what was approved is
    no longer what would be sent."""
    row = get_or_404(db, action_id)
    if row.status == "cancelled":
        raise HTTPException(status_code=409, detail="This draft was cancelled")
    changes = body.model_dump(exclude_unset=True)
    if "to" in changes:
        changes["to"] = emailer._clean(changes["to"], 320)
        if changes["to"] and not emailer.EMAIL_RE.match(changes["to"]):
            raise HTTPException(status_code=422, detail="'to' must be an email address")
    for key in ("subject", "body"):
        if changes.get(key, "keep") is None:
            changes.pop(key)
    changes = {k: v for k, v in changes.items() if getattr(row, k) != v}
    if not changes:
        return row.to_api()  # nothing changed, so an existing approval still holds
    for key, value in changes.items():
        setattr(row, key, value)
    row.status, row.approved_at = "needs_approval", None
    db.add(row)
    db.commit()
    db.refresh(row)
    return row.to_api()


@router.post("/{action_id}/approve", response_model=Action, response_model_exclude_none=True)
def approve(action_id: str, db: Session = Depends(get_session)):
    row = get_or_404(db, action_id)
    if row.status == "cancelled":
        raise HTTPException(status_code=409, detail="This draft was cancelled")
    if row.status != "approved":
        row.status, row.approved_at = "approved", utcnow()
        db.add(row)
        db.commit()
        db.refresh(row)
    return row.to_api()


@router.post("/{action_id}/cancel", response_model=Action, response_model_exclude_none=True)
def cancel(action_id: str, db: Session = Depends(get_session)):
    row = get_or_404(db, action_id)
    row.status, row.approved_at = "cancelled", None
    db.add(row)
    db.commit()
    db.refresh(row)
    return row.to_api()
