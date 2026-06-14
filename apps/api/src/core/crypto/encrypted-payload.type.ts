export interface EncryptedPayload {
  authTag: string;
  ciphertext: string;
  iv: string;
}
