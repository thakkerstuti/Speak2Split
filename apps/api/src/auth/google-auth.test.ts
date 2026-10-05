import { getGoogleClientId, verifyGoogleIdToken, InvalidGoogleTokenError } from "./google-auth";

jest.mock("google-auth-library", () => {
  const mockVerifyIdToken = jest.fn();
  return {
    OAuth2Client: jest.fn().mockImplementation(() => ({
      verifyIdToken: mockVerifyIdToken,
    })),
    __mockVerifyIdToken: mockVerifyIdToken,
  };
});

const { __mockVerifyIdToken } = jest.requireMock("google-auth-library");

describe("Google Auth Verification", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("getGoogleClientId", () => {
    it("returns empty string when no env var is set", () => {
      delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
      delete process.env.GOOGLE_WEB_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_ID;
      expect(getGoogleClientId()).toBe("");
    });

    it("prefers GOOGLE_OAUTH_CLIENT_ID over others", () => {
      process.env.GOOGLE_OAUTH_CLIENT_ID = "oauth-client-id.apps.googleusercontent.com";
      process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = "expo-client-id.apps.googleusercontent.com";
      expect(getGoogleClientId()).toBe("oauth-client-id.apps.googleusercontent.com");
    });
  });

  describe("verifyGoogleIdToken", () => {
    it("successfully verifies valid Google ID token payload", async () => {
      process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
      __mockVerifyIdToken.mockResolvedValueOnce({
        getPayload: () => ({
          sub: "google-user-12345",
          email: "user@example.com",
          email_verified: true,
          name: "Test User",
          picture: "https://example.com/avatar.jpg",
        }),
      });

      const result = await verifyGoogleIdToken("valid.mock.token");

      expect(result).toEqual({
        googleUserId: "google-user-12345",
        email: "user@example.com",
        emailVerified: true,
        name: "Test User",
        avatarUrl: "https://example.com/avatar.jpg",
      });
      expect(__mockVerifyIdToken).toHaveBeenCalledWith({
        idToken: "valid.mock.token",
        audience: "test-client-id.apps.googleusercontent.com",
      });
    });

    it("throws InvalidGoogleTokenError when verification fails", async () => {
      __mockVerifyIdToken.mockRejectedValue(new Error("Token expired"));

      await expect(verifyGoogleIdToken("invalid.token")).rejects.toThrow(InvalidGoogleTokenError);
    });

    it("throws InvalidGoogleTokenError when required payload claims are missing", async () => {
      __mockVerifyIdToken.mockResolvedValueOnce({
        getPayload: () => ({
          sub: "google-user-12345",
          // email is missing
        }),
      });

      await expect(verifyGoogleIdToken("incomplete.token")).rejects.toThrow(InvalidGoogleTokenError);
    });
  });
});
