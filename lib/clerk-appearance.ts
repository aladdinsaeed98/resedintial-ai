/**
 * Clerk dark look. Matches the glass dashboard. Sign-in cannot command HVAC.
 */

export const clerkAppearance = {
  variables: {
    colorPrimary: "#22d3ee",
    colorBackground: "#0b1220",
    colorInputBackground: "rgba(8, 14, 26, 0.85)",
    colorInputText: "#e8eef7",
    colorText: "#e8eef7",
    colorTextSecondary: "#93a4b8",
    colorDanger: "#ff4d6d",
    colorSuccess: "#22d3ee",
    borderRadius: "0.9rem",
    fontFamily: "var(--font-body), \"Segoe UI\", sans-serif",
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
