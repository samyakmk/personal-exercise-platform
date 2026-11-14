export type DownloadLinkProps = {
  href: string;
  label: string;
  compact?: boolean;
  accessibilityLabel?: string;
  validated?: {
    filename: string;
    onStart: () => void;
    onError: (message: string, status?: number) => void;
  };
};

export function DownloadLink(_props: DownloadLinkProps) {
  return null;
}
