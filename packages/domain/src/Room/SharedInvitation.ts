// Separate HMAC domain from all UUID-based personal invitations. This marker is
// also understood by the existing fragment parser; it never identifies a person.
export const SHARED_INVITATION = "room";
export const SHARED_ATTEMPTS = "__shared_invitation__";
