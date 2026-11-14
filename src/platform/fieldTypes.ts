export type SelectProps = {
  label: string;
  visibleLabel?: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

export type DateTimeProps = {
  label: string;
  kind: 'date' | 'time';
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
};
