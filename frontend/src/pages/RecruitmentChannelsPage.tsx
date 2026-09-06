import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { listCampuses } from "@/api/campuses";
import { ApiError } from "@/api/client";
import {
  createChannelRule,
  createRecruitmentChannel,
  listChannelRules,
  listRecruitmentChannels,
  updateChannelRule,
  updateRecruitmentChannel,
} from "@/api/recruitmentChannels";
import type {
  ChannelRuleRead,
  RecruitmentChannelKind,
  RecruitmentChannelMode,
  RecruitmentChannelRead,
  StaffRoleCategory,
} from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { required, useFieldValidation } from "@/hooks/useFieldValidation";

// Mirrors app/api/v1/routers/recruitment_channels.py::_write_gate --
// MANAGE_RECRUITMENT_CHANNELS, or the two roles that historically owned
// reference tables. Reads are staff-wide.
const WRITE_ROLES = ["SUPER_ADMIN", "HR_ADMIN"];

// Mirror app/models/enums.py.
const KINDS: RecruitmentChannelKind[] = [
  "JOB_PORTAL", "ACADEMIC_PORTAL", "SOCIAL", "CAREERS_PAGE", "EMAIL", "INTERNAL", "REFERRAL", "AGENCY",
];
const MODES: { value: RecruitmentChannelMode; label: string; help: string }[] = [
  { value: "API", label: "API (via n8n)", help: "This system calls the n8n workflow at the path below; n8n holds the portal credentials." },
  { value: "FEED", label: "Feed", help: "The channel pulls a public feed; nothing is sent." },
  { value: "MANUAL_ASSISTED", label: "Manual", help: "A person posts the prepared ad and records the portal's reference." },
  { value: "INTERNAL", label: "Internal", help: "Live the moment the posting is published." },
];
const CATEGORIES: StaffRoleCategory[] = ["TEACHING", "NON_TEACHING", "HOUSEKEEPING"];

type Tab = "CHANNELS" | "RULES";

interface ChannelForm {
  code: string;
  kind: RecruitmentChannelKind;
  mode: RecruitmentChannelMode;
  integrationPath: string;
  categories: StaffRoleCategory[];
  campusIds: string[];
  isActive: boolean;
  displayOrder: string;
  notes: string;
}
const EMPTY_CHANNEL: ChannelForm = {
  code: "", kind: "JOB_PORTAL", mode: "API", integrationPath: "job-distribution",
  categories: [], campusIds: [], isActive: true, displayOrder: "100", notes: "",
};

interface RuleForm {
  priority: string;
  matchCategory: StaffRoleCategory | "";
  matchCampusId: string;
  channelIds: string[];
  autoSelect: boolean;
  isActive: boolean;
  notes: string;
}
const EMPTY_RULE: RuleForm = {
  priority: "100", matchCategory: "", matchCampusId: "", channelIds: [], autoSelect: false, isActive: true, notes: "",
};

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function RecruitmentChannelsPage() {
  const { user, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const canManage = Boolean(user && (WRITE_ROLES.includes(user.role) || hasPermission?.("MANAGE_RECRUITMENT_CHANNELS")));

  const [tab, setTab] = useState<Tab>("CHANNELS");
  const { data: channels, isLoading: channelsLoading } = useQuery({
    queryKey: ["recruitment-channels"],
    queryFn: () => listRecruitmentChannels(),
  });
  const { data: rules, isLoading: rulesLoading } = useQuery({ queryKey: ["channel-rules"], queryFn: listChannelRules });
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });
  const campusById = new Map((campuses ?? []).map((c) => [c.id, c]));
  const channelById = new Map((channels ?? []).map((c) => [c.id, c]));

  // --- channel dialog ---------------------------------------------------
  const [channelOpen, setChannelOpen] = useState(false);
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [channelForm, setChannelForm] = useState<ChannelForm>(EMPTY_CHANNEL);
  const channelName = useFieldValidation("", required("Name is required"));
  const [channelError, setChannelError] = useState<string | null>(null);

  function openCreateChannel() {
    setEditingChannelId(null);
    setChannelForm(EMPTY_CHANNEL);
    channelName.onChange("");
    setChannelError(null);
    setChannelOpen(true);
  }
  function openEditChannel(channel: RecruitmentChannelRead) {
    setEditingChannelId(channel.id);
    setChannelForm({
      code: channel.code,
      kind: channel.kind,
      mode: channel.mode,
      integrationPath: channel.integration_path ?? "",
      categories: channel.applicable_categories,
      campusIds: channel.applicable_campus_ids,
      isActive: channel.is_active,
      displayOrder: String(channel.display_order),
      notes: channel.notes ?? "",
    });
    channelName.onChange(channel.name);
    setChannelError(null);
    setChannelOpen(true);
  }
  function channelPayload() {
    const needsPath = channelForm.mode === "API" || channelForm.mode === "FEED";
    return {
      name: channelName.value.trim(),
      kind: channelForm.kind,
      mode: channelForm.mode,
      integration_path: needsPath ? channelForm.integrationPath.trim() || null : null,
      applicable_categories: channelForm.categories,
      applicable_campus_ids: channelForm.campusIds,
      is_active: channelForm.isActive,
      display_order: Number(channelForm.displayOrder) || 100,
      notes: channelForm.notes.trim() || null,
    };
  }
  function afterChannelSave() {
    setChannelError(null);
    setChannelOpen(false);
    setEditingChannelId(null);
    void queryClient.invalidateQueries({ queryKey: ["recruitment-channels"] });
    toast.success("Channel saved.");
  }
  const createChannel = useMutation({
    mutationFn: () => createRecruitmentChannel({ code: channelForm.code.trim().toUpperCase(), ...channelPayload() }),
    onSuccess: afterChannelSave,
    onError: (err) => setChannelError(err instanceof ApiError ? err.message : "Failed to create channel"),
  });
  const updateChannel = useMutation({
    mutationFn: () => updateRecruitmentChannel(editingChannelId!, channelPayload()),
    onSuccess: afterChannelSave,
    onError: (err) => setChannelError(err instanceof ApiError ? err.message : "Failed to update channel"),
  });
  const toggleChannelActive = useMutation({
    mutationFn: (channel: RecruitmentChannelRead) => updateRecruitmentChannel(channel.id, { is_active: !channel.is_active }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["recruitment-channels"] }),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to update channel"),
  });
  function submitChannel() {
    if (!channelName.validate()) return;
    if (!editingChannelId && !/^[A-Z][A-Z0-9_]*$/.test(channelForm.code.trim().toUpperCase())) {
      setChannelError("Code must be letters, digits and underscores, starting with a letter.");
      return;
    }
    if (editingChannelId) updateChannel.mutate();
    else createChannel.mutate();
  }

  // --- rule dialog ------------------------------------------------------
  const [ruleOpen, setRuleOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState<RuleForm>(EMPTY_RULE);
  const ruleName = useFieldValidation("", required("Name is required"));
  const [ruleError, setRuleError] = useState<string | null>(null);

  function openCreateRule() {
    setEditingRuleId(null);
    setRuleForm(EMPTY_RULE);
    ruleName.onChange("");
    setRuleError(null);
    setRuleOpen(true);
  }
  function openEditRule(rule: ChannelRuleRead) {
    setEditingRuleId(rule.id);
    setRuleForm({
      priority: String(rule.priority),
      matchCategory: rule.match_category ?? "",
      matchCampusId: rule.match_campus_id ?? "",
      channelIds: rule.channel_ids,
      autoSelect: rule.auto_select,
      isActive: rule.is_active,
      notes: rule.notes ?? "",
    });
    ruleName.onChange(rule.name);
    setRuleError(null);
    setRuleOpen(true);
  }
  function rulePayload() {
    return {
      name: ruleName.value.trim(),
      priority: Number(ruleForm.priority) || 100,
      match_category: ruleForm.matchCategory || null,
      match_campus_id: ruleForm.matchCampusId || null,
      channel_ids: ruleForm.channelIds,
      auto_select: ruleForm.autoSelect,
      is_active: ruleForm.isActive,
      notes: ruleForm.notes.trim() || null,
    };
  }
  function afterRuleSave() {
    setRuleError(null);
    setRuleOpen(false);
    setEditingRuleId(null);
    void queryClient.invalidateQueries({ queryKey: ["channel-rules"] });
    toast.success("Rule saved.");
  }
  const createRule = useMutation({
    mutationFn: () => createChannelRule(rulePayload()),
    onSuccess: afterRuleSave,
    onError: (err) => setRuleError(err instanceof ApiError ? err.message : "Failed to create rule"),
  });
  const updateRule = useMutation({
    mutationFn: () => updateChannelRule(editingRuleId!, rulePayload()),
    onSuccess: afterRuleSave,
    onError: (err) => setRuleError(err instanceof ApiError ? err.message : "Failed to update rule"),
  });
  function submitRule() {
    if (!ruleName.validate()) return;
    if (ruleForm.channelIds.length === 0) {
      setRuleError("Pick at least one channel.");
      return;
    }
    if (editingRuleId) updateRule.mutate();
    else createRule.mutate();
  }

  if (!user || user.role === "CANDIDATE") {
    return <p className="text-sm text-muted-foreground">Only staff can view Recruitment Channels.</p>;
  }

  const sortedChannels = [...(channels ?? [])].sort((a, b) => a.display_order - b.display_order || a.code.localeCompare(b.code));
  const sortedRules = [...(rules ?? [])].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Recruitment Channels</h1>
          <p className="text-sm text-muted-foreground">
            Where job postings go, and which channels a new posting is recommended on.
          </p>
        </div>
        {canManage ? (
          tab === "CHANNELS" ? (
            <Button onClick={openCreateChannel}>New channel</Button>
          ) : (
            <Button onClick={openCreateRule}>New rule</Button>
          )
        ) : null}
      </div>

      <Tabs<Tab>
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "CHANNELS", label: `Channels (${channels?.length ?? 0})` },
          { value: "RULES", label: `Rules (${rules?.length ?? 0})` },
        ]}
      />

      {tab === "CHANNELS" ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Categories</TableHead>
                  <TableHead>Campuses</TableHead>
                  <TableHead>Active</TableHead>
                  {canManage ? <TableHead /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {channelsLoading ? (
                  <TableEmpty colSpan={8} loading />
                ) : sortedChannels.length === 0 ? (
                  <TableEmpty colSpan={8}>No channels yet.</TableEmpty>
                ) : (
                  sortedChannels.map((channel) => (
                    <TableRow key={channel.id}>
                      <TableCell className="font-mono text-xs">{channel.code}</TableCell>
                      <TableCell className="font-medium">{channel.name}</TableCell>
                      <TableCell>{channel.kind.replace(/_/g, " ")}</TableCell>
                      <TableCell>{MODES.find((m) => m.value === channel.mode)?.label ?? channel.mode}</TableCell>
                      <TableCell>
                        {channel.applicable_categories.length === 0
                          ? "All"
                          : channel.applicable_categories.map((c) => c.replace(/_/g, " ")).join(", ")}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {channel.applicable_campus_ids.length === 0
                          ? "All"
                          : channel.applicable_campus_ids.map((id) => campusById.get(id)?.code ?? "?").join(", ")}
                      </TableCell>
                      <TableCell>
                        {canManage ? (
                          <Switch
                            aria-label={`${channel.code} active`}
                            checked={channel.is_active}
                            disabled={toggleChannelActive.isPending}
                            onCheckedChange={() => toggleChannelActive.mutate(channel)}
                          />
                        ) : (
                          <Badge variant={channel.is_active ? "success" : "outline"}>{channel.is_active ? "Active" : "Inactive"}</Badge>
                        )}
                      </TableCell>
                      {canManage ? (
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" onClick={() => openEditChannel(channel)}>
                            Edit
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rule</TableHead>
                  <TableHead>Applies to</TableHead>
                  <TableHead>Channels</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Auto-select</TableHead>
                  <TableHead>Active</TableHead>
                  {canManage ? <TableHead /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rulesLoading ? (
                  <TableEmpty colSpan={7} loading />
                ) : sortedRules.length === 0 ? (
                  <TableEmpty colSpan={7}>No rules yet. Every new posting will start with no channels.</TableEmpty>
                ) : (
                  sortedRules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell className="font-medium">{rule.name}</TableCell>
                      <TableCell>
                        {[
                          rule.match_category ? rule.match_category.replace(/_/g, " ") : null,
                          rule.match_campus_id ? campusById.get(rule.match_campus_id)?.code ?? "campus" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "Every posting"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {rule.channel_ids.map((id) => channelById.get(id)?.code ?? "?").join(", ")}
                      </TableCell>
                      <TableCell>{rule.priority}</TableCell>
                      <TableCell>{rule.auto_select ? <Badge variant="info">Auto</Badge> : "Review"}</TableCell>
                      <TableCell>
                        <Badge variant={rule.is_active ? "success" : "outline"}>{rule.is_active ? "Active" : "Inactive"}</Badge>
                      </TableCell>
                      {canManage ? (
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" onClick={() => openEditRule(rule)}>
                            Edit
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={channelOpen} onOpenChange={setChannelOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingChannelId ? "Edit channel" : "New channel"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="channel_code">Code</Label>
                {editingChannelId ? (
                  <p className="font-mono text-sm text-muted-foreground">{channelForm.code}</p>
                ) : (
                  <Input
                    id="channel_code"
                    value={channelForm.code}
                    onChange={(e) => setChannelForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                    placeholder="LINKEDIN"
                  />
                )}
                {editingChannelId ? <p className="text-xs text-muted-foreground">Code can't change: n8n and history use it.</p> : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="channel_name">Name</Label>
                <Input
                  id="channel_name"
                  value={channelName.value}
                  onChange={(e) => channelName.onChange(e.target.value)}
                  onBlur={channelName.onBlur}
                  aria-invalid={Boolean(channelName.error)}
                />
                {channelName.error ? <p className="text-xs text-destructive">{channelName.error}</p> : null}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Kind</Label>
                <Select value={channelForm.kind} onValueChange={(v) => setChannelForm((f) => ({ ...f, kind: v as RecruitmentChannelKind }))}>
                  <SelectTrigger aria-label="Kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {k.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Mode</Label>
                <Select value={channelForm.mode} onValueChange={(v) => setChannelForm((f) => ({ ...f, mode: v as RecruitmentChannelMode }))}>
                  <SelectTrigger aria-label="Mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODES.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{MODES.find((m) => m.value === channelForm.mode)?.help}</p>
              </div>
            </div>
            {channelForm.mode === "API" || channelForm.mode === "FEED" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="channel_path">{channelForm.mode === "API" ? "n8n webhook path" : "Feed path"}</Label>
                <Input
                  id="channel_path"
                  value={channelForm.integrationPath}
                  onChange={(e) => setChannelForm((f) => ({ ...f, integrationPath: e.target.value }))}
                  placeholder="job-distribution"
                />
                <p className="text-xs text-muted-foreground">A path under the configured n8n base, never a full URL.</p>
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label>Staff categories (none = all)</Label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <Button
                    key={c}
                    type="button"
                    size="sm"
                    variant={channelForm.categories.includes(c) ? "default" : "outline"}
                    onClick={() => setChannelForm((f) => ({ ...f, categories: toggle(f.categories, c) }))}
                  >
                    {c.replace(/_/g, " ")}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Campuses (none = all)</Label>
              <div className="flex flex-wrap gap-2">
                {(campuses ?? []).filter((c) => c.is_active).map((c) => (
                  <Button
                    key={c.id}
                    type="button"
                    size="sm"
                    variant={channelForm.campusIds.includes(c.id) ? "default" : "outline"}
                    onClick={() => setChannelForm((f) => ({ ...f, campusIds: toggle(f.campusIds, c.id) }))}
                  >
                    {c.code}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="channel_order">Display order</Label>
                <Input
                  id="channel_order"
                  type="number"
                  min={0}
                  value={channelForm.displayOrder}
                  onChange={(e) => setChannelForm((f) => ({ ...f, displayOrder: e.target.value }))}
                />
              </div>
              <div className="flex items-center gap-3 pt-6">
                <Switch id="channel_active" checked={channelForm.isActive} onCheckedChange={(v) => setChannelForm((f) => ({ ...f, isActive: v }))} />
                <Label htmlFor="channel_active">Active</Label>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="channel_notes">Notes (optional)</Label>
              <Textarea id="channel_notes" rows={2} value={channelForm.notes} onChange={(e) => setChannelForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            {channelError ? <p className="text-sm text-destructive">{channelError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChannelOpen(false)}>
              Cancel
            </Button>
            <Button disabled={createChannel.isPending || updateChannel.isPending} onClick={submitChannel}>
              {createChannel.isPending || updateChannel.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ruleOpen} onOpenChange={setRuleOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingRuleId ? "Edit rule" : "New rule"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rule_name">Name</Label>
              <Input
                id="rule_name"
                value={ruleName.value}
                onChange={(e) => ruleName.onChange(e.target.value)}
                onBlur={ruleName.onBlur}
                aria-invalid={Boolean(ruleName.error)}
              />
              {ruleName.error ? <p className="text-xs text-destructive">{ruleName.error}</p> : null}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Staff category</Label>
                <Select value={ruleForm.matchCategory || "ANY"} onValueChange={(v) => setRuleForm((f) => ({ ...f, matchCategory: v === "ANY" ? "" : (v as StaffRoleCategory) }))}>
                  <SelectTrigger aria-label="Staff category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ANY">Any</SelectItem>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Campus</Label>
                <Select value={ruleForm.matchCampusId || "ANY"} onValueChange={(v) => setRuleForm((f) => ({ ...f, matchCampusId: v === "ANY" ? "" : v }))}>
                  <SelectTrigger aria-label="Campus">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ANY">Any</SelectItem>
                    {(campuses ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Channels to recommend</Label>
              <div className="flex flex-wrap gap-2">
                {sortedChannels.filter((c) => c.is_active || ruleForm.channelIds.includes(c.id)).map((c) => (
                  <Button
                    key={c.id}
                    type="button"
                    size="sm"
                    variant={ruleForm.channelIds.includes(c.id) ? "default" : "outline"}
                    onClick={() => setRuleForm((f) => ({ ...f, channelIds: toggle(f.channelIds, c.id) }))}
                  >
                    {c.code}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rule_priority">Priority</Label>
                <Input id="rule_priority" type="number" min={0} value={ruleForm.priority} onChange={(e) => setRuleForm((f) => ({ ...f, priority: e.target.value }))} />
              </div>
              <div className="flex items-center gap-3 pt-6">
                <Switch id="rule_auto" checked={ruleForm.autoSelect} onCheckedChange={(v) => setRuleForm((f) => ({ ...f, autoSelect: v }))} />
                <Label htmlFor="rule_auto">Auto-select</Label>
              </div>
              <div className="flex items-center gap-3 pt-6">
                <Switch id="rule_active" checked={ruleForm.isActive} onCheckedChange={(v) => setRuleForm((f) => ({ ...f, isActive: v }))} />
                <Label htmlFor="rule_active">Active</Label>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Auto-selected channels skip the recruiter's review. The most specific matching rule wins; priority breaks ties.
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rule_notes">Notes (optional)</Label>
              <Textarea id="rule_notes" rows={2} value={ruleForm.notes} onChange={(e) => setRuleForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            {ruleError ? <p className="text-sm text-destructive">{ruleError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRuleOpen(false)}>
              Cancel
            </Button>
            <Button disabled={createRule.isPending || updateRule.isPending} onClick={submitRule}>
              {createRule.isPending || updateRule.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
