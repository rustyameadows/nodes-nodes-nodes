import { randomUUID } from "node:crypto";

export function newId() {
  return randomUUID();
}

export function nowIso() {
  return new Date().toISOString();
}
