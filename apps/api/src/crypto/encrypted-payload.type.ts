// api-local i/o shape for an aes-256-gcm encrypted value — all three fields
// base64. it is i/o-bound (never crosses /api), so it lives here, not in
// @opspilot/shared.
export interface EncryptedPayload {
  authTag: string;
  ciphertext: string;
  iv: string;
}
