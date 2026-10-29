import { prisma } from "@qb/db";

export type CandidateDecision = "approve" | "reject" | "link_only";

export async function reviewCandidate(
  id: string,
  decision: CandidateDecision,
  opts: { reviewerId?: string; reason?: string } = {},
): Promise<any> {
  const statusMap: Record<CandidateDecision, string> = {
    approve: "approved",
    reject: "rejected",
    link_only: "link_only",
  };
  return prisma.questionCandidate.update({
    where: { id },
    data: {
      status: statusMap[decision],
      reviewerId: opts.reviewerId ?? null,
      rejectionReason: opts.reason ?? null,
      reviewedAt: new Date(),
    },
  });
}
