import { prisma } from "@qb/db";

export interface RegisterSourceInput {
  name: string;
  baseUrl: string;
  allowedDomains: string[];
  rightsStatus: string;
  licenceDocumentUrl?: string;
  evidencePath?: string;
  commercialUse: boolean;
  modificationAllowed: boolean;
  translationAllowed: boolean;
  redistributionAllowed: boolean;
  attributionRequired: boolean;
  termsUrl?: string;
  allowedToCrawl: boolean;
  allowedToIngestText: boolean;
  allowedToDisplay: boolean;
  approvedBy: string;
  listingUrls: string[];
}

export async function registerSource(input: RegisterSourceInput) {
  const paperKeys = input.listingUrls.map((u) => {
    try {
      const url = new URL(u);
      return url.pathname.split("/").pop()?.replace(/\.pdf$/, "").replace(/\.html$/, "") || "";
    } catch {
      return "";
    }
  }).filter(Boolean);

  const source = await prisma.source.create({
    data: {
      name: input.name,
      baseUrl: input.baseUrl,
      allowedDomains: input.allowedDomains,
      rightsStatus: input.rightsStatus,
      licenceDocumentUrl: input.licenceDocumentUrl,
      evidencePath: input.evidencePath,
      commercialUse: input.commercialUse,
      modificationAllowed: input.modificationAllowed,
      translationAllowed: input.translationAllowed,
      redistributionAllowed: input.redistributionAllowed,
      attributionRequired: input.attributionRequired,
      termsUrl: input.termsUrl,
      robotsReviewedDate: new Date(),
      allowedToCrawl: input.allowedToCrawl,
      allowedToIngestText: input.allowedToIngestText,
      allowedToDisplay: input.allowedToDisplay,
      approvedBy: input.approvedBy,
      approvedAt: new Date(),
      status: "approved",
      listingUrls: input.listingUrls,
      paperKeys,
    },
  });

  await prisma.licenceRecord.create({
    data: {
      sourceId: source.id,
      licenceName: `${input.name} Licence`,
      documentUrl: input.licenceDocumentUrl,
      evidencePath: input.evidencePath,
      commercialUse: input.commercialUse,
      modificationAllowed: input.modificationAllowed,
      translationAllowed: input.translationAllowed,
      redistributionAllowed: input.redistributionAllowed,
      attributionText: input.attributionRequired ? `Source: ${input.name}` : undefined,
      reviewedBy: input.approvedBy,
    },
  });

  return source;
}