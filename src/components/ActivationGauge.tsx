import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface ActivationGaugeProps {
  /**
   * Current envelope relative to the session's best rep so far. Null means no
   * rep has been completed yet, so there's nothing to compare against.
   */
  ratio: number | null;
}

const BEST_SO_FAR_COLOR = '#33C481';
const BUILDING_COLOR = '#2F6FED';

/**
 * A glanceable live bar for mid-rep feedback — meant to be readable at a
 * glance while exerting, not read closely like a number. Fills toward the
 * session's best completed rep so far; turns green once you're matching or
 * beating it. Deliberately not a precise numeric readout: a self-referential,
 * relative-effort signal like this shouldn't be dressed up as more precise
 * than it is.
 */
export default function ActivationGauge({ ratio }: ActivationGaugeProps) {
  const hasReference = ratio !== null;
  const fillFraction = hasReference ? Math.min(Math.max(ratio, 0), 1) : 0;
  const atOrAboveBest = hasReference && ratio >= 1;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Live Activation</Text>
        {atOrAboveBest && <Text style={styles.bestLabel}>Best so far!</Text>}
      </View>
      <View style={styles.track}>
        {hasReference ? (
          <View
            style={[
              styles.fill,
              {
                width: `${fillFraction * 100}%`,
                backgroundColor: atOrAboveBest ? BEST_SO_FAR_COLOR : BUILDING_COLOR,
              },
            ]}
          />
        ) : null}
      </View>
      {!hasReference && (
        <Text style={styles.hint}>Complete a rep to start comparing</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1C1F26',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    color: '#E6E8EB',
    fontSize: 13,
    fontWeight: '600',
  },
  bestLabel: {
    color: '#33C481',
    fontSize: 12,
    fontWeight: '700',
  },
  track: {
    height: 14,
    borderRadius: 7,
    backgroundColor: '#2A2D35',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 7,
  },
  hint: {
    color: '#8A8F98',
    fontSize: 11,
    marginTop: 6,
  },
});
