import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text as NativeText, TextInput as NativeInput, View } from 'react-native';
import type { TextProps, TextInputProps } from 'react-native';
import { colors, ui } from '../lib/theme';

export function Text({ style, ...props }: TextProps) {
  return <NativeText {...props} style={[styles.text, style]} />;
}

export function TextInput({ style, onFocus, onBlur, ...props }: TextInputProps) {
  const [focused, setFocused] = useState(false);
  return <NativeInput {...props} accessibilityLabel={props.accessibilityLabel ?? props.placeholder} placeholderTextColor={colors.muted} selectionColor={colors.mint} keyboardAppearance="dark" onFocus={event => { setFocused(true); onFocus?.(event); }} onBlur={event => { setFocused(false); onBlur?.(event); }} style={[ui.input, style, focused && styles.focused]} />;
}

type ButtonProps = { title: string; onPress: () => void; disabled?: boolean; variant?: 'primary' | 'secondary' | 'quiet'; loading?: boolean };
export function Button({ title, onPress, disabled = false, variant = 'secondary', loading = false }: ButtonProps) {
  const primary = variant === 'primary';
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || loading, busy: loading }} disabled={disabled || loading} onPress={onPress} style={({ pressed }) => [styles.button, variant === 'primary' ? styles.primary : variant === 'quiet' ? styles.quiet : styles.secondary, (disabled || loading) && styles.disabled, pressed && styles.pressed]}>
    {loading && <ActivityIndicator color={primary ? colors.onMint : colors.silver} />}
    <NativeText style={[styles.buttonText, { color: primary ? colors.onMint : colors.text }]}>{title}</NativeText>
  </Pressable>;
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return <View style={styles.brand}><NativeText style={[styles.wordmark, compact && { fontSize: 21 }]}>SpeakLoop<NativeText style={{ color: colors.mint }}>.</NativeText></NativeText>{!compact && <NativeText style={ui.label}>BY TINKIT STUDIO</NativeText>}</View>;
}

const styles = StyleSheet.create({
  text: { color: colors.silver, fontSize: 16, lineHeight: 25 },
  focused: { borderColor: colors.mint, borderWidth: 2 },
  button: { minHeight: 52, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderWidth: 1 },
  primary: { backgroundColor: colors.mint, borderColor: colors.mint },
  secondary: { backgroundColor: colors.elevated, borderColor: colors.border },
  quiet: { backgroundColor: 'transparent', borderColor: 'transparent' },
  buttonText: { fontSize: 16, lineHeight: 23, fontWeight: '700', textAlign: 'center' },
  disabled: { opacity: 0.45 }, pressed: { opacity: 0.75 },
  brand: { gap: 8 }, wordmark: { color: colors.text, fontSize: 36, fontWeight: '800', letterSpacing: -1.4 },
});
