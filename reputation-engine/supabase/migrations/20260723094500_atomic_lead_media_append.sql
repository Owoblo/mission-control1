CREATE OR REPLACE FUNCTION public.append_crm_lead_media(
  p_lead_id text,
  p_assets jsonb,
  p_survey_increment integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_data jsonb;
BEGIN
  UPDATE public.crm_leads AS lead
  SET
    data = lead.data || jsonb_build_object(
      'mediaAssets',
      COALESCE(lead.data->'mediaAssets', '[]'::jsonb) ||
        COALESCE((
          SELECT jsonb_agg(candidate.asset)
          FROM jsonb_array_elements(COALESCE(p_assets, '[]'::jsonb)) AS candidate(asset)
          WHERE NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(lead.data->'mediaAssets', '[]'::jsonb)) AS existing(asset)
            WHERE existing.asset->>'id' = candidate.asset->>'id'
          )
        ), '[]'::jsonb),
      'surveyPhotoCount',
      COALESCE((lead.data->>'surveyPhotoCount')::integer, 0) + GREATEST(p_survey_increment, 0)
    ),
    updated_at = now()
  WHERE lead.id = p_lead_id
    AND COALESCE(lead.deleted, false) = false
  RETURNING lead.data INTO updated_data;

  RETURN updated_data;
END;
$$;

REVOKE ALL ON FUNCTION public.append_crm_lead_media(text, jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_crm_lead_media(text, jsonb, integer) TO service_role;
