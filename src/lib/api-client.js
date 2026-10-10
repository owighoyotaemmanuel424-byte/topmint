// Client-side helper for calling this app's own JSON APIs.
//
// `response.json()` throws when the body is not JSON. If the hosting layer returns
// a plain-text error page (for example Netlify's "Internal Server Error" 500) the
// browser surfaces that parse failure with a platform-specific message — WebKit
// says "The string did not match the expected pattern." — which used to reach the
// UI as if it described the customer's account. Reading the body as text first
// keeps every call site on one predictable shape and lets each page explain what
// actually happened.

export async function requestJson(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    return { ok: false, status: 0, data: null, invalidBody: false, networkError: true };
  }

  const text = await response.text();
  let data = null;
  let invalidBody = !text;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      invalidBody = true;
    }
  }

  return { ok: response.ok, status: response.status, data, invalidBody, networkError: false };
}

// Human-readable text for a failed requestJson result. Uses the API's own message
// when there is one and stays honest when the server answered with something the
// page cannot interpret.
export function apiErrorMessage(result, fallback = 'Something went wrong. Please try again.') {
  if (result?.networkError) return 'We could not reach TopMint. Check your connection and try again.';
  const data = result?.data;
  if (data && typeof data === 'object' && typeof data.error === 'string' && data.error) return data.error;
  if (result?.invalidBody) {
    return `The server could not complete that request (error ${result?.status || 'unknown'}). Please try again shortly.`;
  }
  return fallback;
}
