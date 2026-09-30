import { Link as RouterLink } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { MuscleViewer } from "@/features/muscle";

export function HomePage() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">React SPA Boilerplate</h1>
          <p className="text-sm text-slate-500">
            筋肉ストレッチビューワー: 筋肉伸び率ビューワー（MyoFullBody 筋骨格モデル）
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full font-mono border border-slate-200">
            MyoFullBody: 416 筋アクチュエータ / 123 自由度
          </span>
          <Button asChild variant="outline" size="sm">
            <RouterLink to="/users">Users</RouterLink>
          </Button>
        </div>
      </div>

      <MuscleViewer />
    </div>
  );
}
