import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.enums import (
    EmploymentTypeEnum,
    RecruitmentChannelKindEnum,
    RecruitmentChannelModeEnum,
    StaffRoleCategoryEnum,
)


class RecruitmentChannelBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: RecruitmentChannelKindEnum
    mode: RecruitmentChannelModeEnum
    integration_path: str | None = Field(default=None, max_length=200)
    config: dict | None = None
    applicable_categories: list[StaffRoleCategoryEnum] = Field(default_factory=list)
    applicable_campus_ids: list[uuid.UUID] = Field(default_factory=list)
    is_active: bool = True
    display_order: int = Field(default=100, ge=0, le=10_000)
    notes: str | None = None


def _posting_url_is_http(value: dict | None) -> dict | None:
    # `config.posting_url` is where a person goes to post by hand; the job
    # posting screen opens it in a new tab, so it must be a web address.
    url = (value or {}).get("posting_url")
    if url is not None and (not isinstance(url, str) or not url.startswith(("http://", "https://"))):
        raise ValueError("config.posting_url must start with http:// or https://")
    return value


class RecruitmentChannelCreate(RecruitmentChannelBase):
    code: str = Field(min_length=2, max_length=40, pattern=r"^[A-Z][A-Z0-9_]*$")

    _config_posting_url = field_validator("config")(_posting_url_is_http)

    @field_validator("integration_path")
    @classmethod
    def _path_is_relative(cls, value: str | None) -> str | None:
        # A webhook PATH under N8N_BASE_URL, never a full URL: the base is the
        # one place the n8n host is configured.
        if value and ("://" in value or value.startswith("/")):
            raise ValueError("integration_path must be a relative path under N8N_BASE_URL")
        return value


class RecruitmentChannelUpdate(BaseModel):
    # `code` is deliberately absent: n8n workflows and legacy audit rows
    # address a channel by it, so it never changes once created.
    name: str | None = Field(default=None, min_length=1, max_length=120)
    kind: RecruitmentChannelKindEnum | None = None
    mode: RecruitmentChannelModeEnum | None = None
    integration_path: str | None = Field(default=None, max_length=200)
    config: dict | None = None
    applicable_categories: list[StaffRoleCategoryEnum] | None = None
    applicable_campus_ids: list[uuid.UUID] | None = None
    is_active: bool | None = None
    display_order: int | None = Field(default=None, ge=0, le=10_000)
    notes: str | None = None

    _path_is_relative = field_validator("integration_path")(RecruitmentChannelCreate._path_is_relative.__func__)
    _config_posting_url = field_validator("config")(_posting_url_is_http)


class RecruitmentChannelRead(RecruitmentChannelBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    configuration_status: str
    configuration_message: str | None
    posting_url: str | None
    created_at: datetime
    updated_at: datetime


class ChannelRuleBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    is_active: bool = True
    priority: int = Field(default=100, ge=0, le=10_000)
    match_category: StaffRoleCategoryEnum | None = None
    match_campus_id: uuid.UUID | None = None
    match_department_id: uuid.UUID | None = None
    match_designation_id: uuid.UUID | None = None
    match_employment_type: EmploymentTypeEnum | None = None
    channel_ids: list[uuid.UUID] = Field(min_length=1)
    auto_select: bool = False
    notes: str | None = None


class ChannelRuleCreate(ChannelRuleBase):
    pass


class ChannelRuleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    is_active: bool | None = None
    priority: int | None = Field(default=None, ge=0, le=10_000)
    match_category: StaffRoleCategoryEnum | None = None
    match_campus_id: uuid.UUID | None = None
    match_department_id: uuid.UUID | None = None
    match_designation_id: uuid.UUID | None = None
    match_employment_type: EmploymentTypeEnum | None = None
    channel_ids: list[uuid.UUID] | None = Field(default=None, min_length=1)
    auto_select: bool | None = None
    notes: str | None = None


class ChannelRuleRead(ChannelRuleBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
