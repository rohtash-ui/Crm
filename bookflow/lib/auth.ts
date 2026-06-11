import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import { prisma } from "./prisma";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          // Both calendar scopes: read/write events + freeBusy
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/calendar",
            "https://www.googleapis.com/auth/calendar.events",
          ].join(" "),
          access_type: "offline",
          // Always force consent so we always receive a refresh_token
          prompt: "consent",
        },
      },
    }),
  ],
  session: { strategy: "database" },
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        (session.user as any).id = user.id;
      }
      return session;
    },

    // Fires after every successful sign-in.
    // We use it to keep CalendarConnection in sync with the
    // latest tokens that NextAuth wrote into the Account table.
    async signIn({ user, account }) {
      if (account?.provider === "google" && user.id) {
        try {
          const accessToken = account.access_token;
          const refreshToken = account.refresh_token;
          const expiresAt = account.expires_at
            ? new Date(account.expires_at * 1000)
            : null;

          if (accessToken) {
            await prisma.calendarConnection.upsert({
              where: {
                userId_provider: { userId: user.id, provider: "google" },
              },
              create: {
                userId: user.id,
                provider: "google",
                accessToken,
                refreshToken: refreshToken ?? null,
                expiresAt,
                connectedEmail: user.email ?? null,
              },
              update: {
                accessToken,
                // Only overwrite refresh token when a new one arrives
                // (Google omits it on subsequent logins if not forced)
                ...(refreshToken ? { refreshToken } : {}),
                expiresAt,
                connectedEmail: user.email ?? null,
              },
            });
          }
        } catch (err) {
          // Non-fatal: log and continue sign-in
          console.error("[Auth] CalendarConnection sync failed:", err);
        }
      }
      return true;
    },
  },
  pages: {
    signIn: "/login",
  },
};

export function auth() {
  return getServerSession(authOptions);
}
