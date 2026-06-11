import { getPayPalApiBase, requireEnv } from "./env";

async function getAccessToken(): Promise<string> {
  const clientId = requireEnv("PAYPAL_CLIENT_ID");
  const clientSecret = requireEnv("PAYPAL_CLIENT_SECRET");

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(`${getPayPalApiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`PayPal token request failed: ${err}`);
  }

  const data = await response.json();
  return data.access_token;
}

export async function createPayPalOrder(
  amount: number,
  currency: string,
  description: string
): Promise<{ id: string; status: string }> {
  const accessToken = await getAccessToken();

  const response = await fetch(`${getPayPalApiBase()}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": `bookflow-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: currency,
            value: amount.toFixed(2),
          },
          description,
        },
      ],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`PayPal order creation failed: ${JSON.stringify(data)}`);
  }

  return data;
}

export async function capturePayPalOrder(orderId: string): Promise<CaptureResult> {
  const accessToken = await getAccessToken();

  const response = await fetch(
    `${getPayPalApiBase()}/v2/checkout/orders/${orderId}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  const data = await response.json();

  if (!response.ok && response.status !== 422) {
    throw new Error(`PayPal capture failed: ${JSON.stringify(data)}`);
  }

  return data;
}

export async function getPayPalOrder(orderId: string): Promise<{ status: string }> {
  const accessToken = await getAccessToken();

  const response = await fetch(`${getPayPalApiBase()}/v2/checkout/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`PayPal get order failed: ${JSON.stringify(data)}`);
  }
  return data;
}

export async function verifyWebhookSignature(body: string, headers: Record<string, string>, webhookId: string): Promise<boolean> {
  try {
    const accessToken = await getAccessToken();

    const response = await fetch(
      `${getPayPalApiBase()}/v1/notifications/verify-webhook-signature`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          auth_algo: headers["paypal-auth-algo"],
          cert_id: headers["paypal-cert-id"],
          cert_url: headers["paypal-cert-url"],
          transmission_id: headers["paypal-transmission-id"],
          transmission_sig: headers["paypal-transmission-sig"],
          transmission_time: headers["paypal-transmission-time"],
          webhook_id: webhookId,
          webhook_event: JSON.parse(body),
        }),
      }
    );

    const result = await response.json();
    return result.verification_status === "SUCCESS";
  } catch {
    return false;
  }
}

export interface CaptureResult {
  id: string;
  status: string;
  purchase_units?: Array<{
    payments?: {
      captures?: Array<{
        id: string;
        status: string;
        amount: { value: string; currency_code: string };
      }>;
    };
  }>;
  payer?: {
    email_address?: string;
    payer_id?: string;
  };
}
