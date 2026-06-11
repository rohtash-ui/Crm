import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">B</span>
          </div>
          <span className="font-semibold text-gray-900 text-lg">BookFlow</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-gray-600 hover:text-gray-900 text-sm font-medium">
            Sign in
          </Link>
          <Link
            href="/login"
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Get started free
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex items-center justify-center px-6 py-20">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 px-4 py-2 rounded-full text-sm font-medium mb-8">
            <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
            Smart scheduling with built-in payments
          </div>
          <h1 className="text-5xl font-bold text-gray-900 mb-6 leading-tight">
            Let clients book and pay,{" "}
            <span className="text-blue-600">all at once</span>
          </h1>
          <p className="text-xl text-gray-600 mb-10 max-w-2xl mx-auto leading-relaxed">
            Create event types, set your availability, and share your booking link.
            Clients pay via PayPal before confirming — you get paid and Google Calendar
            handles the rest.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link
              href="/login"
              className="bg-blue-600 text-white px-8 py-4 rounded-xl font-semibold text-lg hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
            >
              Start booking for free
            </Link>
            <Link
              href="/login"
              className="border border-gray-300 text-gray-700 px-8 py-4 rounded-xl font-semibold text-lg hover:bg-gray-50 transition-colors"
            >
              See how it works
            </Link>
          </div>
        </div>
      </main>

      {/* Features */}
      <section className="bg-white py-20 px-6 border-t border-gray-100">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">
            Everything you need to get booked
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: "📅",
                title: "Easy scheduling",
                desc: "Set your availability once. Clients pick what works for them, 24/7.",
              },
              {
                icon: "💳",
                title: "PayPal payments",
                desc: "Require payment upfront. No more no-shows. Get paid before the meeting.",
              },
              {
                icon: "🗓️",
                title: "Google Calendar sync",
                desc: "Confirmed bookings auto-appear in your Google Calendar with Meet links.",
              },
            ].map((f) => (
              <div key={f.title} className="p-6 bg-gray-50 rounded-xl">
                <div className="text-4xl mb-4">{f.icon}</div>
                <h3 className="font-semibold text-gray-900 text-lg mb-2">{f.title}</h3>
                <p className="text-gray-600 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="bg-gray-900 text-gray-400 py-8 px-6 text-center text-sm">
        <p>© 2024 BookFlow. All rights reserved.</p>
      </footer>
    </div>
  );
}
