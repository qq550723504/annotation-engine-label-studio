"""Authorization service boundary.

Project/task/review policy is intentionally not implemented in the identity
foundation milestone. Protected resource checks default deny until later
milestones provide concrete policy.
"""

from rest_framework.exceptions import PermissionDenied

from .identity import Principal


class AuthorizationService:
    """Central entry point for annotation-engine authorization policy."""

    @staticmethod
    def require_authenticated(principal: Principal) -> Principal:
        return principal

    @staticmethod
    def can_view_project(principal: Principal, project) -> bool:
        return False

    @staticmethod
    def can_label_task(principal: Principal, task) -> bool:
        return False

    @staticmethod
    def can_update_annotation(principal: Principal, annotation) -> bool:
        return False

    @staticmethod
    def can_review_submission(principal: Principal, submission) -> bool:
        return False

    @staticmethod
    def require(allowed: bool, message: str = "You do not have permission to perform this action.") -> None:
        if not allowed:
            raise PermissionDenied(message)


authorization = AuthorizationService()
