import { useQuery } from "@tanstack/react-query";
import { Download, Printer, QrCode } from "lucide-react";
import { useEffect, useState } from "react";

import { getVacancyRequestQrInfo, getVacancyRequestQrPng } from "@/api/vacancyRequests";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// QR management panel for the public vacancy-request intake (2026-08-30).
// One GLOBAL code per the brief -- nothing here is per-campus or per-user, so
// there is no "generate" step in the sense of creating a record: the code is
// derived from configuration and rendered on demand.

export function VacancyRequestQrPanel() {
  const { data: info } = useQuery({ queryKey: ["vacancy-request-qr-info"], queryFn: getVacancyRequestQrInfo });
  const { data: pngBlob } = useQuery({ queryKey: ["vacancy-request-qr-png"], queryFn: getVacancyRequestQrPng });
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  // The endpoint is authenticated, so the PNG arrives as a blob and needs an
  // object URL. Revoked on unmount -- an object URL that is never revoked
  // pins the blob in memory for the life of the tab.
  useEffect(() => {
    if (!pngBlob) return;
    const url = URL.createObjectURL(pngBlob);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pngBlob]);

  function download() {
    if (!imageUrl) return;
    const link = document.createElement("a");
    link.href = imageUrl;
    link.download = "simats-vacancy-request-qr.png";
    link.click();
  }

  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-4 p-4 sm:flex-row sm:items-center">
        <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-lg border border-border bg-white p-2">
          {imageUrl ? (
            <img src={imageUrl} alt="QR code linking to the public vacancy request form" className="h-full w-full" />
          ) : (
            <QrCode className="h-10 w-10 text-muted-foreground" aria-hidden />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">Scan to submit a vacancy request</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Print this and put it where department heads will see it. Submissions arrive as normal vacancy
            requests, pending Dean approval.
          </p>
          {/* The target shown as text beside the image: a printed QR is far
              easier to trust when you can read where it goes. */}
          {info ? (
            <p className="mt-1.5 font-mono text-[11px] break-all text-muted-foreground">{info.url}</p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={download} disabled={!imageUrl}>
              <Download className="h-3.5 w-3.5" />
              Download QR
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.print()} disabled={!imageUrl}>
              <Printer className="h-3.5 w-3.5" />
              Print QR
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
