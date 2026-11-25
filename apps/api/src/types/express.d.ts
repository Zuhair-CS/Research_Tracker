import 'express-session';
import type { Role, ResearcherType } from '../generated/prisma/enums.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  researcherType: ResearcherType | null;
  departmentId: string | null;
  orcidId: string | null;
  openalexAuthorId: string | null;
}

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    csrfToken?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      /** Set by loadUser() when the session belongs to an active account. */
      user?: AuthUser;
    }
  }
}
