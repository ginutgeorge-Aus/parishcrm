import { UserRole } from "@/lib/generated/prisma/enums"
import { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    deviceTrustGrant?: string
    user: {
      id: string
      role: UserRole
    } & DefaultSession["user"]
  }

  interface User {
    role: UserRole
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    deviceTrustGrant?: string
    // Stamped by jwtCallback at sign-in; absent on a fresh pre-sign-in token
    // (beta.32 dropped the base JWT index signature, so these must be optional
    // for an empty `{}` token to type-check). sessionCallback casts them to the
    // required Session shape once stamped.
    id?: string
    role?: UserRole
    // Epoch ms when this session was issued and when it last saw real
    // user activity. Optional so tokens minted before this change still
    // satisfy the type until they expire.
    loginAt?: number
    lastActivity?: number
  }
}
