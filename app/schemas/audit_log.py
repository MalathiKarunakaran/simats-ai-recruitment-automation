import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AuditLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    actor_user_id: uuid.UUID | None
    actor_role_snapshot: str | None
    campus_context_id: uuid.UUID | None
    action: str
    entity_type: str | None
    entity_id: uuid.UUID | None
    before_state: dict | None
    after_state: dict | None
    http_method: str | None
    http_path: str | None
    status_code: int | None
    ip_address: str | None
    user_agent: str | None
    created_at: datetime
