import React from 'react';
import { Pressable, Text, View } from 'react-native';

// Shared visual language for all Bloco workspaces.
// Kept dependency-free so it remains compatible with Expo Go.
export const design = {
  colors: {
    canvas: '#F5F6F3',
    surface: '#FFFFFF',
    surfaceMuted: '#F0F3EF',
    ink: '#1F3027',
    inkSoft: '#68766D',
    accent: '#315C49',
    accentStrong: '#244B39',
    accentWash: '#E7EFE8',
    border: '#E3E8E2',
    borderStrong: '#CCD7CE',
    warning: '#B86B35',
    danger: '#B4514A',
    white: '#FFFFFF',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  radius: { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 },
  typography: {
    title: { fontSize: 25, lineHeight: 31, fontWeight: '700', letterSpacing: -0.5 },
    section: { fontSize: 17, lineHeight: 23, fontWeight: '700', letterSpacing: -0.2 },
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
        minWidth: 44,
        minHeight: 44,
        paddingHorizontal: 10,
        borderRadius: design.radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? design.colors.accentWash : design.colors.surface,
        borderWidth: 1,
        borderColor: active ? '#C9DCCF' : design.colors.border,
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

export function ScreenHeader({ eyebrow, title, subtitle, onBack, right }) {
  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: design.spacing.md,
      paddingVertical: design.spacing.md,
      marginBottom: design.spacing.sm,
    }}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          onPress={onBack}
          hitSlop={6}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: design.radius.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: design.colors.surface,
            borderWidth: 1,
            borderColor: design.colors.border,
            opacity: pressed ? 0.65 : 1,
          })}
        >
          <Text style={{ color: design.colors.ink, fontSize: 29, lineHeight: 32, marginTop: -3 }}>‹</Text>
        </Pressable>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        {eyebrow ? <Text style={{ ...design.typography.label, color: design.colors.accent, marginBottom: 5 }}>{eyebrow}</Text> : null}
        <Text numberOfLines={1} style={{ ...design.typography.title, color: design.colors.ink }}>{title}</Text>
        {subtitle ? <Text numberOfLines={2} style={{ ...design.typography.caption, color: design.colors.inkSoft, marginTop: 4 }}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function ScreenTitle({ eyebrow, title, subtitle, right }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: design.spacing.xl }}>
      <View style={{ flex: 1 }}>
        {eyebrow ? <Text style={{ ...design.typography.label, color: design.colors.accent, marginBottom: 5 }}>{eyebrow}</Text> : null}
        <Text numberOfLines={2} style={{ ...design.typography.title, color: design.colors.ink }}>{title}</Text>
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
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'center',
      rowGap: 5,
      columnGap: 5,
      minHeight: 56,
      paddingHorizontal: 9,
      paddingVertical: 6,
      backgroundColor: design.colors.surface,
      borderWidth: 1,
      borderColor: design.colors.border,
      borderRadius: 18,
      marginHorizontal: 10,
      marginVertical: 5,
      shadowColor: '#18251D',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 8,
      elevation: 2,
    }}>
      {children}
    </View>
  );
}
