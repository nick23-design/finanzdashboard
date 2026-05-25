import { Suspense } from "react";
import { AlertsView } from "@/components/alerts/AlertsView";

export const metadata = { title: "Kurs-Alarme – Next Horizon" };

export default function AlertsPage() {
  return (
    <Suspense>
      <AlertsView />
    </Suspense>
  );
}
