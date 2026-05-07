// Paired with Airtable Search Duplicate (alwaysOutputData = true)
const airtable = $input.first().json;
const job = $('Normalize Job').item.json;
const is_duplicate = Boolean(airtable.id);

return [
  {
    json: {
      ...job,
      _airtable_duplicate: airtable,
      is_duplicate,
    },
  },
];
