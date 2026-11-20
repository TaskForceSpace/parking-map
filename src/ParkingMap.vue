<script setup>
defineProps({
  label: { type: String, required: true },
  viewBox: { type: String, required: true },
});
</script>

<template>
  <svg :viewBox="viewBox" role="img" :aria-label="label" width="100%" style="display: block">
    <slot />
  </svg>
</template>
