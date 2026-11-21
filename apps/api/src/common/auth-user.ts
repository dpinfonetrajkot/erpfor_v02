/** The logged-in user, attached to each request by the AuthGuard. */
export interface AuthUser {
  id: number;
  username: string;
  name: string;
  email: string | null;
  roleId: number;
  roleName: string;
  permissions: string[];
  sessionId: number;
}

/** Who is doing something - passed from controllers into services for auditing. */
export interface Actor {
  userId: number;
  ip: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
