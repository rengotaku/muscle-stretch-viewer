import { Link as RouterLink } from "react-router-dom";
import { CircleCheck } from "lucide-react";

import { TailwindDemo } from "@/components";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MuscleViewer } from "@/features/muscle";

const features = [
  "Vite + TypeScript",
  "React Router",
  "TanStack Query (API state)",
  "Zustand (UI state)",
  "ky (HTTP client)",
  "Vitest + Testing Library",
  "Tailwind CSS + shadcn/ui",
];

export function HomePage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-2 text-3xl font-bold tracking-tight">React SPA Boilerplate</h1>
        <p className="text-slate-500">筋肉伸び率ビューワー（MyoFullBody 筋骨格モデル）</p>
      </div>

      {/* 3D Muscle Viewer */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight text-slate-800">
            筋肉伸び率 3D ビューワー（前屈ポーズ）
          </h2>
          <span className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full font-mono border border-slate-200">
            MyoFullBody: 416 筋アクチュエータ / 123 自由度
          </span>
        </div>
        <MuscleViewer />
      </section>

      <Card className="mb-6 max-w-md">
        <CardHeader>
          <CardTitle>Features</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {features.map((feature) => (
              <li key={feature} className="flex items-center gap-2 text-sm">
                <CircleCheck className="size-4 shrink-0 text-primary" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Button asChild>
        <RouterLink to="/users">Users</RouterLink>
      </Button>

      <TailwindDemo />
    </div>
  );
}
