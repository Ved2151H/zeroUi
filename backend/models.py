"""Pydantic models for request/response validation."""

from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum
from datetime import datetime


class TriggerType(str, Enum):
    FALL = "fall"
    MANUAL = "manual"


class EmergencyStatus(str, Enum):
    SAFE = "safe"
    VERIFYING = "verifying"
    EMERGENCY = "emergency"
    RESOLVED = "resolved"


class EventLog(BaseModel):
    event_type: str  # e.g. "fall_detected", "no_movement", "verification_started", etc.
    description: str
    timestamp: str  # ISO string from client


class EmergencyCreate(BaseModel):
    user_id: str = Field(..., min_length=1)
    latitude: float
    longitude: float
    digipin: Optional[str] = None  # Generated server-side
    trigger_type: TriggerType
    status: EmergencyStatus = EmergencyStatus.EMERGENCY
    event_logs: list[EventLog] = []


class LocationUpdate(BaseModel):
    latitude: float
    longitude: float
    digipin: Optional[str] = None  # Generated server-side
    timestamp: Optional[str] = None


class StatusUpdate(BaseModel):
    status: EmergencyStatus


class EmergencyResponse(BaseModel):
    id: int
    user_id: str
    status: str
    trigger_type: str
    latitude: float
    longitude: float
    digipin: str
    created_at: str
    resolved_at: Optional[str] = None
    events: list[dict] = []
    locations: list[dict] = []
    has_audio: bool = False
