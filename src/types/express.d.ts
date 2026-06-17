// src/types/express.d.ts
// Augments Express's Request type so req.user is typed everywhere in the app.
// This file is picked up automatically by TypeScript via the tsconfig include.

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: "CUSTOMER" | "ADMIN" | "SUPER_ADMIN" | "STAFF";
        /** True when this ADMIN is the tenant's primary shop owner. */
        isPrimaryAdmin?: boolean;
        /** The primary ADMIN's id for secondary admins; null/undefined for primaries. */
        primaryAdminId?: string | null;
      };
    }
  }
}

export {};
