import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { api } from '../api'
import { useAuth } from './AuthContext'

const LeadContext = createContext(null)

export function LeadProvider({ children }) {
  const { user } = useAuth()
  const [requests, setRequests] = useState([])
  const [stats, setStats] = useState({ totalLeads: 0, pending: 0, completed: 0, failed: 0 })
  const [streamingIds, setStreamingIds] = useState(new Set())
  const [globalSearchQuery, setGlobalSearchQuery] = useState('')
  const [notifications, setNotifications] = useState([])

  const addNotification = useCallback((notification) => {
    setNotifications(prev => [
      {
        id: Math.random().toString(36).substring(2, 9),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        read: false,
        ...notification
      },
      ...prev
    ])
  }, [])

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }, [])

  const toggleRead = useCallback((id) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: !n.read } : n))
  }, [])

  const clearNotification = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
  }, [])

  const fetchRequests = useCallback(async () => {
    const [reqs, s] = await Promise.all([
      api.get('/requests'),
      api.get('/requests/stats'),
    ])
    setRequests(reqs)
    setStats({
      totalLeads: s.total_leads || 0,
      pending: s.pending || 0,
      completed: s.completed || 0,
      failed: s.failed || 0,
    })
    return reqs
  }, [user])

  useEffect(() => {
    if (user) {
      fetchRequests().catch(() => {})
    } else {
      setRequests([])
      setStats({ totalLeads: 0, pending: 0, completed: 0, failed: 0 })
    }
  }, [user, fetchRequests])


  const statusKey = useMemo(() => requests.map(r => r.status).join(','), [requests])


  useEffect(() => {
    const pendingReqs = requests.filter(r =>
      r.status === 'Pending' || r.status === 'pending' ||
      r.status === 'Active' || r.status === 'active'
    )
    if (pendingReqs.length === 0) return

    setStreamingIds(new Set(pendingReqs.map(r => r.id)))

    const sources = pendingReqs.map(req => {
      const es = api.createStatusStream(req.id)

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data)
          const s = data.status?.toLowerCase()
          if (s === 'completed') {
            addNotification({
              type: 'success',
              title: 'Request Completed',
              description: `Request "${req.title || 'Untitled'}" has finished successfully.`
            })
            fetchRequests().catch(() => {})
            es.close()
          } else if (s === 'failed') {
            addNotification({
              type: 'warning',
              title: 'Request Failed',
              description: `Request "${req.title || 'Untitled'}" encountered an error.`
            })
            fetchRequests().catch(() => {})
            es.close()
          }
        } catch {

        }
      }

      es.onerror = () => es.close()

      return es
    })

    return () => {
      sources.forEach(es => es.close())
      setStreamingIds(new Set())
    }
  }, [statusKey, fetchRequests, addNotification, requests])

  const getResults = useCallback(async (requestId) => {
    const leadDoc = await api.get(`/leads?request_id=${encodeURIComponent(requestId)}`)
    const rawLeads = leadDoc.leads || []

    const cleanUrl = (url) => {
      if (!url || typeof url !== 'string') return null;
      let cleaned = url.replace(/^(Linkedin|X|Twitter|Facebook|Crunchbase|Website|Source):\s*/i, '').trim();
      const lower = cleaned.toLowerCase();
      if (
        lower === 'null' || 
        lower === 'none' || 
        lower === 'not found' || 
        lower === 'not available' || 
        lower === ''
      ) {
        return null;
      }
      // If it doesn't start with http://, https://, or isn't an absolute path, prepend https://
      if (!/^https?:\/\//i.test(cleaned)) {
        cleaned = `https://${cleaned}`;
      }
      return cleaned;
    };

    const leads = rawLeads.map((lead, index) => {
      const cleanedLead = { ...lead };
      

      ['linkedin_url', 'x_url', 'twitter_url', 'facebook_url', 'crunchbase_url', 'source_url', 'url'].forEach(key => {
        if (cleanedLead[key]) cleanedLead[key] = cleanUrl(cleanedLead[key]);
      });


      if (cleanedLead.decision_makers && Array.isArray(cleanedLead.decision_makers)) {
        cleanedLead.decision_makers = cleanedLead.decision_makers.map(dm => ({
          ...dm,
          linkedin_url: dm.linkedin_url ? cleanUrl(dm.linkedin_url) : ''
        }));
      }

      return {
        ...cleanedLead,
        name: cleanedLead.contact_name || cleanedLead.company_name || cleanedLead.title || `Lead ${index + 1}`,
        company: cleanedLead.company_name || cleanedLead.title || 'Unknown',
        title: cleanedLead.title || null,
        email: cleanedLead.email || cleanedLead.contact_email || '',
        phone: cleanedLead.phone || cleanedLead.contact_phone || null,
        source_url: cleanedLead.url || cleanedLead.source_url || null,
        match_score: Number(cleanedLead.match_score || 0),
      };
    });

    const rawUserQuery = leadDoc?.user_query || {}
    const userQuery = {
      title: rawUserQuery?.title || null,
      business_type: rawUserQuery?.business_type || rawUserQuery?.businessType || null,
      ideal_lead_profile: rawUserQuery?.ideal_lead_profile || rawUserQuery?.idealLeadProfile || null,
      budget_target_size: rawUserQuery?.budget_target_size || rawUserQuery?.budgetTargetSize || null,
      target_location: rawUserQuery?.target_location || rawUserQuery?.targetLocation || null,
      created_at: rawUserQuery?.created_at || null,
      status: rawUserQuery?.status || null,
    }

    return {
      request_id: leadDoc.request_id || requestId,
      request_summary: leadDoc.request_summary || `Found ${leads.length} leads for request`,
      leads,
      competitors: leadDoc.competitors || [],
      total_found: leadDoc.total_found ?? leads.length,
      queries: leadDoc.queries || [],
      user_query: Object.values(userQuery).some(Boolean) ? userQuery : undefined,
    }
  }, [])

  const refreshRequests = useCallback(() => fetchRequests().catch(() => {}), [fetchRequests])

  const deleteRequest = useCallback(async (requestId) => {
    const req = requests.find(r => String(r.id || r._id) === String(requestId))
    await api.deleteRequest(requestId)
    addNotification({
      type: 'info',
      title: 'Request Deleted',
      description: `Request "${req?.title || 'Untitled'}" was deleted.`
    })
    await fetchRequests().catch(() => {})
  }, [fetchRequests, requests, addNotification])

  return (
    <LeadContext.Provider value={{
      requests, getResults, stats, refreshRequests, streamingIds, deleteRequest,
      globalSearchQuery, setGlobalSearchQuery,
      notifications, addNotification, markAllRead, toggleRead, clearNotification
    }}>
      {children}
    </LeadContext.Provider>
  )
}

export const useLeads = () => useContext(LeadContext)
