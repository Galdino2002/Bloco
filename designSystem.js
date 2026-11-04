import React from 'react';
import { Pressable, Text, View } from 'react-native';

// Shared visual language for the Bloco editor.
// Kept dependency-free so it remains compatible with Expo Go.
export const design = {
  colors: {
    canvas: '#F3F3F1',
    surface: '#FFFFFF',
    surfaceMuted: '#F1F2EF',
    ink: '#202522',
    inkSoft: '#68716B',
    accent: '#315C49',
    accentStrong: '#244B39',
    accentWash: '#E2ECE5',
    border: '#E5E7E3',
    borderStrong: '#CDD4CE',
    warning: '#B86B35',
    danger: '#B4514A',
    white: '#FFFFFF',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  radius: { sm: 9, md: 13, lg: 18, xl: 24, pill: 999 },
  typography: {
    title: { fontSize: 24, lineHeight: 29, fontWeight: '700' },
    section: { fontSize: 17, lineHeight: 22, fontWeight: '700' },
    body: { fontSize: 14, lineHeight: 20 },
    caption: { fontSize: 11, lineHeight: 15 },
    label: { fontSize: 10, lineHeight: 13, fontWeight: '800', letterSpacing: 0.8 },
  },
};

export function IconButton({
  label,
  onPress,
  active = false,
  disabled = false,
  accessibilityLabel,
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      accessibilityLabel={accessibilityLabel || label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        minWidth: 42,
        minHeight: 42,
        paddingHorizontal: 10,
        borderRadius: design.radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? design.colors.accentWash : 'transparent',
        borderWidth: active ? 1 : 1,
        borderColor: active ? '#C9DCCF' : 'transparent',
        opacity: disabled ? 0.32 : pressed ? 0.62 : 1,
      })}
    >
      <Text style={{
        color: active ? design.colors.accentStrong : design.colors.ink,
        fontSize: 19,
        lineHeight: 23,
        fontWeight: '600',
      }}>{label}</Text>
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

// Shared floating-style toolbar used by notebooks and the writing workspace.
export function ContextToolbar({ children }) {
  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      minHeight: 54,
      paddingHorizontal: 9,
      paddingVertical: 6,
      backgroundColor: design.colors.surface,
      borderWidth: 1,
      borderColor: design.colors.border,
      borderRadius: 16,
      marginHorizontal: 10,
      marginVertical: 5,
      shadowColor: '#18251D',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.07,
      shadowRadius: 8,
      elevation: 2,
    }}>
      {children}
    </View>
  );
}
