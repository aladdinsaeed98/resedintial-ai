/**
 * Clerk dark look. Matches the near-black dashboard. Sign-in cannot command HVAC.
 */

export const clerkAppearance = {
  variables: {
    colorPrimary: "#22d3ee",
    colorBackground: "#0a0a0a",
    colorInputBackground: "rgba(0, 0, 0, 0.85)",
    colorInputText: "#ffffff",
    colorText: "#ffffff",
    colorTextSecondary: "#8a8a8a",
    colorDanger: "#ff4d6d",
    colorSuccess: "#22d3ee",
    borderRadius: "0.6rem",
    fontFamily: "var(--font-body), Inter, \"Segoe UI\", sans-serif",
  },
  elements: {
    card: "clerk-card",
    headerTitle: "clerk-title",
    headerSubtitle: "clerk-sub",
    socialButtonsBlockButton: "clerk-social",
    formButtonPrimary: "clerk-primary",
    footerActionLink: "clerk-link",
  },
};
