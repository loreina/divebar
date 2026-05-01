import { test, expect } from 'bun:test';
import {
  parseVariantName,
  buildVariantProperties,
} from '../../../src/adapters/figma/variants';

test('parseVariantName splits comma-separated key=value pairs', () => {
  expect(parseVariantName('Size=Small, Kind=Primary')).toEqual({
    Size: 'Small',
    Kind: 'Primary',
  });
});

test('parseVariantName trims whitespace around keys and values', () => {
  expect(parseVariantName('  Size = Small , Kind = Primary  ')).toEqual({
    Size: 'Small',
    Kind: 'Primary',
  });
});

test('parseVariantName ignores parts without `=`', () => {
  expect(parseVariantName('Size=Small,broken,Kind=Primary')).toEqual({
    Size: 'Small',
    Kind: 'Primary',
  });
});

test('parseVariantName accepts equals signs in the value', () => {
  expect(parseVariantName('Label=A=B=C')).toEqual({ Label: 'A=B=C' });
});

test('buildVariantProperties unions distinct values per key, preserving first-seen order', () => {
  const children = [
    { name: 'Size=Small, Kind=Primary' },
    { name: 'Size=Large, Kind=Primary' },
    { name: 'Size=Small, Kind=Secondary' },
  ];
  expect(buildVariantProperties(children)).toEqual({
    Size: ['Small', 'Large'],
    Kind: ['Primary', 'Secondary'],
  });
});

test('buildVariantProperties tolerates malformed child names', () => {
  const children = [
    { name: 'Size=Small' },
    { name: 'oops' },
    { name: '' },
    { name: 'Size=Small' },
  ];
  expect(buildVariantProperties(children)).toEqual({ Size: ['Small'] });
});
