import React from 'react';
import { Pressable, Text, View } from 'react-native';

export const design = {
  colors: {
    canvas: '#F4F6F1',
    surface: '#FFFFFF',
    surfaceMuted: '#EDF2EC',
    ink: '#18352B',
    inkSoft: '#466156',
    accent: '#2F6B51',
    accentStrong: '#1F503B',
    accentWash: '#DDEBE0',
    border: '#DCE5DD',
    borderStrong: '#C4D4C7',
    warning: '#B86B35',
    danger: '#B4514A',
    white: '#FFFFFF',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },
  radius: {
    sm: 8,
    md: 12,
    lg: 18,
    xl: 24,
    pill: 999,
  },
  typography: {
    title: { fontSize: 24, lineHeight: 29, fontWeight: '700' },
    section: { fontSize: 17, lineHeight: 22, fontWeight: '700' },
    body: { fontSize: 14, lineHeight: 20 },
    caption: { fontSize: 11, lineHeight: 15 },
    label: { fontSize: 10, lineHeight: 13, fontWeight: '800', letterSpacing: 0.8 },
  },
};

export function IconButton({ label, onPress, active = false, disabled = false, accessibilityLabel }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minWidth: 42,
        minHeight: 42,
        paddingHorizontal: 10,
        borderRadius: design.radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? design.colors.accentWash : design.colors.surfaceMuted,
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ color: active ? design.colors.accentStrong : design.colors.inkSoft, fontSize: 17, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

export function ScreenTitle({ eyebrow, title, subtitle, right }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: design.spacing.lg }}>
      <View style={{ flex: 1 }}>
        {eyebrow ? <Text style={{ ...design.typography.label, color: design.colors.accent, marginBottom: 5 }}>{eyebrow}</Text> : null}
        <Text style={{ ...design.typography.title, color: design.colors.ink }}>{title}</Text>
        {subtitle ? <Text style={{ ...design.typography.caption, color: design.colors.inkSoft, marginTop: 4 }}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function ContextToolbar({ children }) {
  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: design.spacing.sm,
      paddingHorizontal: design.spacing.md,
      paddingVertical: design.spacing.sm,
      backgroundColor: design.colors.surface,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: design.colors.border,
    }}>
      {children}
    </View>
  );
}
