import { useQuery } from "@tanstack/react-query";

import { listPostingHistory } from "@/api/jobPostingChannels";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const COLUMN_COUNT = 5;

function words(value: string): string {
  return value.replace(/_/g, " ").toLowerCase();
}

/** Section G: every posting attempt on every channel, newest first. Needs
 * JOB_DISTRIBUTION, like the channel list it summarises. */
export function PostingHistoryCard({ jobPostingId }: { jobPostingId: string }) {
  const { data: history, isLoading } = useQuery({
    queryKey: ["posting-history", jobPostingId],
    queryFn: () => listPostingHistory(jobPostingId),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Posting history</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>How</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableEmpty colSpan={COLUMN_COUNT} loading />
            ) : !history || history.length === 0 ? (
              <TableEmpty colSpan={COLUMN_COUNT}>Nothing has been posted yet.</TableEmpty>
            ) : (
              history.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="text-xs whitespace-nowrap">{new Date(item.attempted_at).toLocaleString()}</TableCell>
                  <TableCell>{item.channel_name}</TableCell>
                  <TableCell className="text-xs">{words(item.trigger)}</TableCell>
                  <TableCell className={item.outcome === "SUCCEEDED" ? "text-brand-success" : "text-destructive"}>
                    {words(item.outcome)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{item.error_message ?? "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
