"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    paypal?: {
      Buttons: (config: object) => { render: (selector: string) => void };
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
  const rendered = useRef(false);

  useEffect(() => {
    if (rendered.current || !containerRef.current) return;

    const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
    if (!clientId) {
      onError("PayPal is not configured.");
      return;
    }

    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=${currency}`;
    script.onload = () => {
      if (!window.paypal || rendered.current) return;
      rendered.current = true;

      window.paypal
        .Buttons({
          createOrder: async () => {
            const res = await fetch("/api/payments/create-order", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ bookingId }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to create order");
            return data.orderId;
          },
          onApprove: async (data: { orderID: string }) => {
            onSuccess(data.orderID);
          },
          onError: (err: Error) => {
            onError(err.message || "Payment failed");
          },
          style: {
            layout: "vertical",
            color: "blue",
            shape: "rect",
            label: "pay",
          },
        })
        .render("#paypal-button-container");
    };

    document.body.appendChild(script);
  }, [bookingId, currency, onSuccess, onError]);

  return (
    <div>
      <div id="paypal-button-container" ref={containerRef} />
      <p className="text-center text-xs text-gray-400 mt-3">
        Secured by PayPal. You will be redirected to PayPal to complete payment.
      </p>
    </div>
  );
}
