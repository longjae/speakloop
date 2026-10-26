import { StyleSheet } from 'react-native';

export const colors = {
  background: '#0C0E0F', surface: '#171A1C', elevated: '#222729',
  border: '#3A4245', text: '#F0F2F2', silver: '#B8C1C4', muted: '#929DA1',
  mint: '#00D2BC', onMint: '#062B26', danger: '#FFA8A8',
};
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, hero: 48 };
export const ui = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: colors.background, padding: spacing.xl, paddingBottom: spacing.hero, gap: spacing.lg },
  title: { color: colors.text, fontSize: 30, lineHeight: 39, fontWeight: '700', letterSpacing: -0.8 },
  subtitle: { color: colors.silver, fontSize: 16, lineHeight: 25 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 20, padding: spacing.xl, gap: spacing.md },
  cardTitle: { color: colors.text, fontSize: 21, lineHeight: 29, fontWeight: '700' },
  input: { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: spacing.lg, minHeight: 56, fontSize: 16, textAlignVertical: 'center' },
  label: { color: colors.muted, fontSize: 12, lineHeight: 18, fontWeight: '700', letterSpacing: 1.5 },
  error: { color: colors.danger, lineHeight: 24 },
});
