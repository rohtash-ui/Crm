import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

export default async function PublicBookingPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;

  const user = await prisma.user.findUnique({
    where: { username },
    include: { eventTypes: { where: { isActive: true }, orderBy: { createdAt: "asc" } } },
  });

  if (!user) notFound();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-16">
        {/* Host card */}
        <div className="text-center mb-10">
          {user.image ? (
            <Image
              src={user.image}
              alt={user.name || "Host"}
              width={80}
              height={80}
              className="rounded-full mx-auto mb-4"
            />
          ) : (
            <div className="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 text-white text-2xl font-bold">
              {user.name?.[0] || "?"}
            </div>
          )}
          <h1 className="text-2xl font-bold text-gray-900">{user.name}</h1>
          <p className="text-gray-500 mt-1">Book a time with me</p>
        </div>

        {user.eventTypes.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
            <p>No event types available at this time.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {user.eventTypes.map((et) => (
              <Link
                key={et.id}
                href={`/book/${username}/${et.slug}`}
                className="block bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-blue-300 transition-all p-6"
              >
                <div className="flex items-start gap-4">
                  <div
                    className="w-3 h-3 rounded-full mt-1.5 flex-shrink-0"
                    style={{ backgroundColor: et.color }}
                  />
                  <div className="flex-1">
                    <h2 className="font-semibold text-gray-900 text-lg">{et.title}</h2>
                    {et.description && (
                      <p className="text-gray-500 text-sm mt-1">{et.description}</p>
                    )}
                    <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
                      <span>🕐 {et.duration} min</span>
                      {et.location && <span>📍 {et.location}</span>}
                      <span className="font-medium text-gray-900">
                        {et.price === 0 ? "Free" : `$${et.price.toFixed(2)} ${et.currency}`}
                      </span>
                    </div>
                  </div>
                  <span className="text-blue-600">→</span>
                </div>
              </Link>
            ))}
          </div>
        )}

        <p className="text-center text-xs text-gray-400 mt-10">
          Powered by <Link href="/" className="hover:underline">BookFlow</Link>
        </p>
      </div>
    </div>
  );
}
