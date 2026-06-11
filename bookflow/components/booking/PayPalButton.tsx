"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    paypal?: {
      Buttons: (config: object) => { render: (selector: string) => Promise<void>; isEligible: () => boolean };
      FUNDING: Record<string, string>;
    };
  }
}

interface PayPalButtonProps {
  bookingId: string;
  amount: number;
  currency: string;
  onSuccess: (orderId: string) => void;
  onError: (message: string) => void;
}

export default function PayPalButton({
  bookingId,
  amount,
  currency,
  onSuccess,
  onError,
}: PayPalButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [sdkError, setSdkError] = useState("");
  const renderedRef = useRef(false);

  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;

  useEffect(() => {
    if (!clientId) {
      setSdkError("PayPal is not configured. Contact the site owner.");
      return;
    }

    const existingScript = document.querySelector(`script[data-paypal-sdk]`);
    if (existingScript) {
      setSdkLoaded(true);
      return;
    }

    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=${currency}&intent=capture&components=buttons`;
    script.dataset.paypalSdk = "true";
    script.onload = () => setSdkLoaded(true);
    script.onerror = () => setSdkError("Failed to load PayPal SDK. Please refresh and try again.");
    document.body.appendChild(script);
  }, [clientId, currency]);

  useEffect(() => {
    if (!sdkLoaded || renderedRef.current || !containerRef.current || !window.paypal) return;
    renderedRef.current = true;

    window.paypal
      .Buttons({
        fundingSource: window.paypal.FUNDING?.PAYPAL,
        createOrder: async () => {
          const res = await fetch("/api/payments/create-order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bookingId }),
          });
          const data = await res.json();
          if (!res.ok) {
            onError(data.error || "Could not create payment order.");
            throw new Error(data.error);
          }
          return data.orderId;
        },
        onApprove: async (data: { orderID: string }) => {
          onSuccess(data.orderID);
        },
        onError: (err: Error) => {
          console.error("[PayPal] SDK error:", err);
          onError("Payment failed. Please try again or use a different payment method.");
        },
        onCancel: () => {
          onError("Payment was cancelled. You can try again.");
        },
        style: {
          layout: "vertical",
          color: "blue",
          shape: "rect",
          label: "pay",
          height: 44,
        },
      })
      .render("#paypal-button-container");
  }, [sdkLoaded, bookingId, onSuccess, onError]);

  if (sdkError) {
    return (
      <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg">
        {sdkError}
      </div>
    );
  }

  if (!sdkLoaded) {
    return (
      <div className="flex items-center gap-3 text-gray-400 text-sm py-6">
        <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        Loading payment…
      </div>
    );
  }

  return (
    <div>
      <div id="paypal-button-container" ref={containerRef} className="min-h-[50px]" />
      <p className="text-center text-xs text-gray-400 mt-3">
        🔒 Secured by PayPal. Amount: <strong>{amount.toFixed(2)} {currency}</strong>
      </p>
    </div>
  );
}
