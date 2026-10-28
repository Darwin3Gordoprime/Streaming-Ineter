let validationMessageId = 0;

function updateFieldValidation(field, show = false) {
  if (!(field instanceof HTMLElement) || !field.willValidate) return;
  let message = field.dataset.validationMessageId
    ? document.getElementById(field.dataset.validationMessageId)
    : null;
  if (!field.validity.valid && show) {
    if (!message) {
      message = document.createElement('span');
      message.id = `field-validation-${++validationMessageId}`;
      message.className = 'field-validation-message';
      message.setAttribute('role', 'alert');
      field.dataset.validationMessageId = message.id;
      field.insertAdjacentElement('afterend', message);
      const describedBy = new Set((field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
      describedBy.add(message.id);
      field.setAttribute('aria-describedby', [...describedBy].join(' '));
    }
    message.textContent = field.validationMessage || 'Revisa este campo.';
    field.setAttribute('aria-invalid', 'true');
    return;
  }
  if (field.validity.valid) {
    field.removeAttribute('aria-invalid');
    if (message) {
      const describedBy = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== message.id);
      if (describedBy.length) field.setAttribute('aria-describedby', describedBy.join(' '));
      else field.removeAttribute('aria-describedby');
      message.remove();
      delete field.dataset.validationMessageId;
    }
  }
}

document.addEventListener('invalid', event => {
  const field = event.target;
  if (!(field instanceof HTMLElement) || !field.form) return;
  field.form.dataset.validationAttempted = 'true';
  event.preventDefault();
  updateFieldValidation(field, true);
}, true);

document.addEventListener('input', event => {
  const field = event.target;
  if (field instanceof HTMLElement && field.form?.dataset.validationAttempted === 'true') {
    updateFieldValidation(field, true);
  }
});

document.addEventListener('change', event => {
  const field = event.target;
  if (field instanceof HTMLElement && field.form?.dataset.validationAttempted === 'true') {
    updateFieldValidation(field, true);
  }
});

document.addEventListener('submit', event => {
  if (event.target instanceof HTMLFormElement) {
    delete event.target.dataset.validationAttempted;
    event.target.querySelectorAll('input, select, textarea').forEach(field => updateFieldValidation(field));
  }
}, true);
