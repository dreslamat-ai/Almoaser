export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Redirect to the local login page. Call this from an event handler or effect
// at the moment you want to navigate (not during render).
export const startLogin = () => {
  window.location.href = "/login";
};
