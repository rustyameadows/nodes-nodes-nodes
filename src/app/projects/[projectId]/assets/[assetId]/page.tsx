import { AssetDetailView } from "@/components/workspace/views/asset-detail-view";

export default async function ProjectAssetDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; assetId: string }>;
}) {
  const { projectId, assetId } = await params;
  return <AssetDetailView projectId={projectId} assetId={assetId} />;
}
