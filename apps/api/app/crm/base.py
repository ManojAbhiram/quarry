"""CrmConnector interface shared by every CRM integration."""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


class CrmError(Exception):
    """A CRM call failed. `retryable` is True for rate limits, 5xx and network errors (already retried in-call)."""

    def __init__(self, message: str, *, retryable: bool = False, status: Optional[int] = None):
        super().__init__(message)
        self.message = message
        self.retryable = retryable
        self.status = status


@dataclass
class UpsertResult:
    id: str
    created: bool  # False when an existing record (matched by domain/email) was updated


class CrmConnector(ABC):
    provider: str

    @abstractmethod
    async def test_connection(self) -> dict:
        """Verify credentials. Returns display info (e.g. portal id); raises CrmError when rejected."""

    @abstractmethod
    async def upsert_company(self, properties: dict) -> UpsertResult:
        """Create or update a company, deduplicated by its `domain` property."""

    @abstractmethod
    async def upsert_contact(self, properties: dict, company_id: Optional[str] = None) -> UpsertResult:
        """Create or update a contact, deduplicated by its `email` property, optionally linked to a company."""
